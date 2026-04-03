'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

interface InboxTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  isIncome: boolean;
  status: 'Recorded' | 'Needs Info' | 'Action Required';
  paymentStatus?: 'Recorded' | 'Pending Payment' | 'Partially Paid' | 'Paid';
  reconciliationStatus?: 'Unreconciled' | 'Reconciled' | 'Flagged' | string;
  bankDate?: string;
  bankAccountId?: string | null;
}

interface StatementRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  reference?: string;
}

interface BankAccountOption {
  id: string;
  accountName: string;
}

async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Missing session token. Please sign in again.');
  return token;
}

export function BankReconciliationScreen() {
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');

  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [inboxTransactions, setInboxTransactions] = useState<InboxTransaction[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconciling, setIsReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconciliationMessage, setReconciliationMessage] = useState<string | null>(null);
  const [uploadedStatementRows, setUploadedStatementRows] = useState<StatementRow[]>([]);

  // Load bank accounts for the account selector
  useEffect(() => {
    const load = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch('/api/bank-accounts', { headers: { Authorization: `Bearer ${token}` } });
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? 'Failed to load bank accounts.');
        const accounts: BankAccountOption[] = (result.accounts ?? []).map((a: any) => ({
          id: a.id,
          accountName: a.account_name,
        }));
        setBankAccounts(accounts);
        if (accounts.length > 0) setSelectedAccount(accounts[0].id);
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load bank accounts.');
      }
    };
    void load();
  }, []);

  // Load transactions from API and derive bank + inbox lists
  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/transactions', { headers: { Authorization: `Bearer ${token}` } });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'Failed to load transactions.');

      const raw: any[] = result.transactions ?? result.data ?? [];

      // Build available periods (YYYY-MM) from transaction dates
      const periodSet = new Set<string>(raw.map((t) => (t.date as string).substring(0, 7)));
      const sortedPeriods = Array.from(periodSet).sort().reverse();
      setPeriods(sortedPeriods);
      if (sortedPeriods.length > 0 && !selectedPeriod) setSelectedPeriod(sortedPeriods[0]);

      // Recorded (inbox) transactions — all transactions in system
      const inbox: InboxTransaction[] = raw.map((t) => ({
        id: t.id,
        date: new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        description: t.description,
        amount: t.amount,
        isIncome: t.is_income ?? t.isIncome,
        status: (t.status === 'Recorded' || t.status === 'Needs Info' || t.status === 'Action Required')
          ? t.status
          : 'Recorded',
        paymentStatus: t.payment_status,
        reconciliationStatus: t.reconciliation_status,
        bankDate: t.date,
        bankAccountId: t.bank_account_id ?? t.bankAccountId ?? t.assigned_bank_account_id ?? null,
      }));
      setInboxTransactions(inbox);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load transactions.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadTransactions(); }, [loadTransactions]);

  // Filter by selected account and period
  const filteredInbox = inboxTransactions.filter((t) => {
    const periodMatch = !selectedPeriod || (t.bankDate ?? '').startsWith(selectedPeriod);
    const accountMatch = !selectedAccount || (t.bankAccountId ?? '') === selectedAccount;
    const recordedMatch = t.status === 'Recorded';
    return periodMatch && accountMatch && recordedMatch;
  });
  const matchedCount = filteredInbox.filter((t) => t.reconciliationStatus === 'Reconciled').length;
  const pendingCount = filteredInbox.filter((t) => t.reconciliationStatus !== 'Reconciled').length;
  const unmatchedCount = Math.max(0, uploadedStatementRows.length - matchedCount);
  const matchPercentage = uploadedStatementRows.length > 0
    ? Math.round((matchedCount / uploadedStatementRows.length) * 100)
    : 0;

  const parseDateToIso = (value: string) => {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    const slashMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  };

  const parseAmount = (value: string) => {
    const numeric = Number.parseFloat(value.replace(/,/g, '').trim());
    return Number.isFinite(numeric) ? numeric : null;
  };

  const normalizeText = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const dateDiffInDays = (a: string, b: string) => {
    const aDate = new Date(a);
    const bDate = new Date(b);
    if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) {
      return Number.POSITIVE_INFINITY;
    }

    const ms = Math.abs(aDate.getTime() - bDate.getTime());
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  };

  const parseCsvStatement = (text: string): StatementRow[] => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const dateIdx = headers.findIndex((h) => h.includes('date'));
    const descIdx = headers.findIndex((h) => h.includes('description') || h.includes('narration') || h.includes('remarks'));
    const amountIdx = headers.findIndex((h) => h === 'amount' || h.includes('amount'));
    const creditIdx = headers.findIndex((h) => h.includes('credit') || h.includes('deposit'));
    const debitIdx = headers.findIndex((h) => h.includes('debit') || h.includes('withdraw'));
    const refIdx = headers.findIndex((h) => h.includes('ref'));

    const rows: StatementRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const isoDate = dateIdx >= 0 ? parseDateToIso(cols[dateIdx] ?? '') : null;
      const description = descIdx >= 0 ? cols[descIdx] ?? '' : '';
      const reference = refIdx >= 0 ? cols[refIdx] ?? '' : '';

      let amount: number | null = null;
      let type: 'credit' | 'debit' = 'debit';

      if (creditIdx >= 0 || debitIdx >= 0) {
        const credit = creditIdx >= 0 ? parseAmount(cols[creditIdx] ?? '') : null;
        const debit = debitIdx >= 0 ? parseAmount(cols[debitIdx] ?? '') : null;
        if (credit && credit > 0) {
          amount = credit;
          type = 'credit';
        } else if (debit && debit > 0) {
          amount = debit;
          type = 'debit';
        }
      }

      if (amount === null && amountIdx >= 0) {
        const parsedAmount = parseAmount(cols[amountIdx] ?? '');
        if (parsedAmount !== null) {
          amount = Math.abs(parsedAmount);
          type = parsedAmount >= 0 ? 'credit' : 'debit';
        }
      }

      if (!isoDate || !description || amount === null || amount <= 0) {
        continue;
      }

      rows.push({
        id: `stmt-${i}-${Date.now()}`,
        date: isoDate,
        description,
        amount,
        type,
        reference,
      });
    }

    return rows;
  };

  const updateReconciliationOnTransaction = async (
    txn: InboxTransaction,
    statementRef: string
  ) => {
    const token = await getAccessToken();
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transaction: {
          id: txn.id,
          payment_status: txn.paymentStatus || 'Recorded',
          reconciliation_status: 'Reconciled',
          bank_statement_reference: statementRef,
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error ?? `Failed to reconcile transaction ${txn.id}`);
    }
  };

  const handleStatementUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV statement file.');
      return;
    }

    const content = await file.text();
    const parsedRows = parseCsvStatement(content);
    if (parsedRows.length === 0) {
      setError('No valid rows found in the uploaded statement.');
      return;
    }

    setUploadedStatementRows(parsedRows);

    setIsReconciling(true);
    setError(null);
    setReconciliationMessage(null);

    try {
      let matched = 0;
      const usedTransactionIds = new Set<string>();
      const candidatePool = inboxTransactions.filter((txn) => {
        const accountMatch = !selectedAccount || (txn.bankAccountId ?? '') === selectedAccount;
        const periodMatch = !selectedPeriod || (txn.bankDate ?? '').startsWith(selectedPeriod);
        const recordedMatch = txn.status === 'Recorded';
        return accountMatch && periodMatch && recordedMatch;
      });

      for (const stmt of parsedRows) {
        const stmtDescription = normalizeText(stmt.description);

        const candidate = candidatePool
          .filter((txn) => {
            if (usedTransactionIds.has(txn.id)) return false;

            const amountMatch = Math.abs(txn.amount - stmt.amount) <= 1;
            const typeMatch = txn.isIncome === (stmt.type === 'credit');
            if (!amountMatch || !typeMatch) {
              return false;
            }

            const daysDiff = dateDiffInDays(txn.bankDate ?? '', stmt.date);
            return Number.isFinite(daysDiff) && daysDiff <= 3;
          })
          .sort((a, b) => {
            const aDateDiff = dateDiffInDays(a.bankDate ?? '', stmt.date);
            const bDateDiff = dateDiffInDays(b.bankDate ?? '', stmt.date);
            if (aDateDiff !== bDateDiff) {
              return aDateDiff - bDateDiff;
            }

            const aDesc = normalizeText(a.description);
            const bDesc = normalizeText(b.description);
            const aDescScore = stmtDescription && aDesc.includes(stmtDescription) ? 1 : 0;
            const bDescScore = stmtDescription && bDesc.includes(stmtDescription) ? 1 : 0;
            return bDescScore - aDescScore;
          })[0];

        if (!candidate) {
          continue;
        }

        await updateReconciliationOnTransaction(candidate, stmt.reference || stmt.description);
        usedTransactionIds.add(candidate.id);
        matched++;
      }

      const unmatched = parsedRows.length - matched;
      setReconciliationMessage(`Statement uploaded. ${matched} transaction(s) reconciled, ${unmatched} unmatched.`);
      await loadTransactions();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to reconcile uploaded statement.');
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="pt-6 pb-4 px-8 border-b border-border">
        <p className="text-sm text-muted-foreground mb-4">Match bank transactions to inbox entries for accurate cash position</p>

        {error && (
          <div className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {reconciliationMessage && (
          <div className="mb-4 rounded border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent">
            {reconciliationMessage}
          </div>
        )}

        {/* Account & Period Selectors */}
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Account</p>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-3 py-2 text-xs border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {bankAccounts.length === 0 && <option value="">No accounts</option>}
              {bankAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.accountName}</option>
              ))}
            </select>
          </div>
          <div className="ml-8">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Period</p>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="px-3 py-2 text-xs border border-border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All periods</option>
              {periods.map((p) => {
                const [year, month] = p.split('-');
                const label = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
                return <option key={p} value={p}>{label}</option>;
              })}
            </select>
          </div>
          <div className="ml-auto">
            <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Bank Statement</label>
            <label className="inline-flex items-center gap-2 px-3 py-2 text-xs border border-border rounded bg-background hover:bg-muted/20 cursor-pointer">
              <Upload size={14} />
              <span>{isReconciling ? 'Reconciling...' : 'Upload CSV Statement'}</span>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void handleStatementUpload(file);
                  e.currentTarget.value = '';
                }}
                disabled={isReconciling}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="bg-muted/20 border-b border-border px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Match Progress</p>
              <p className="text-2xl font-semibold text-accent">{matchPercentage}%</p>
            </div>
            <div className="flex items-center gap-6 pl-6 border-l border-border">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Matched</p>
                <p className="text-lg font-semibold text-green-700 dark:text-green-400">{matchedCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Pending</p>
                <p className="text-lg font-semibold text-warning">{pendingCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Unmatched</p>
                <p className="text-lg font-semibold text-destructive">{unmatchedCount}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recorded Transactions Layout */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">Loading transactions...</div>
        ) : filteredInbox.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">No transactions found for this period.</div>
        ) : (
        <div className="p-8">
          <div>
            <h2 className="text-lg font-medium mb-4">Recorded Transactions</h2>
            <div className="space-y-3">
              {filteredInbox.map((txn) => (
                <div key={txn.id} className="border border-border rounded-lg p-4 bg-accent/5 hover:bg-accent/10 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{txn.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">{txn.date}</p>
                    </div>
                    <p className="text-sm font-semibold text-accent whitespace-nowrap">
                      {txn.isIncome ? '+' : '−'}₹{txn.amount.toLocaleString()}
                    </p>
                  </div>
                  <p className="text-xs text-foreground/80 mb-2">
                    Amount: {txn.isIncome ? '+' : '−'}₹{txn.amount.toLocaleString('en-IN')}
                  </p>
                  <div
                    className={`text-xs font-medium flex items-center gap-1 ${
                      txn.reconciliationStatus === 'Reconciled'
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    <CheckCircle2 size={14} />
                    {txn.reconciliationStatus === 'Reconciled' ? 'Reconciled' : 'Pending Reconciliation'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
      </div>

      {!isLoading && uploadedStatementRows.length === 0 && (
        <div className="border-t border-border bg-muted/10 p-8 text-sm text-muted-foreground">
          Upload a bank CSV statement to start matching with recorded transactions.
        </div>
      )}
    </main>
  );
}
