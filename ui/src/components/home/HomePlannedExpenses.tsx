import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import PaymentsRoundedIcon from "@mui/icons-material/PaymentsRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { AxiosError } from "axios";
import { useState, type MouseEvent } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  type HomePlannedExpense,
  type PlannedExpenseAction,
  type PlannedExpenseDueState,
  useHomePlannedExpenses,
  usePlannedExpenseAction,
} from "../../api/homePlannedExpenses";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { selectAllowedPageSlugs } from "../../selectors/accessControlSelectors";
import { useAppSelector } from "../../store/hooks";
import { canLoadHomePlannedExpenses } from "./homePlannedExpenseAccess";

type HomePlannedExpensesProps = {
  compact?: boolean;
};

type PendingAction = {
  action: PlannedExpenseAction;
  transaction: HomePlannedExpense;
};

const isRecurringExpense = (transaction: HomePlannedExpense): boolean => {
  const ruleId = transaction.meta?.recurring_rule_id;
  const numericRuleId = typeof ruleId === "number"
    ? ruleId
    : typeof ruleId === "string" && /^\d+$/.test(ruleId.trim())
      ? Number(ruleId)
      : Number.NaN;
  return Number.isInteger(numericRuleId) && numericRuleId > 0;
};

const formatMoney = (amountMinor: number, currency: string): string => {
  const normalizedCurrency = currency.trim().toUpperCase() || "PLN";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${normalizedCurrency}`;
  }
};

const formatDate = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(parsed);
};

const duePresentation: Record<PlannedExpenseDueState, {
  label: string;
  color: "error" | "warning" | "info";
  accent: "error.main" | "warning.main" | "info.main";
  icon: typeof WarningAmberRoundedIcon;
}> = {
  overdue: {
    label: "Overdue",
    color: "error",
    accent: "error.main",
    icon: WarningAmberRoundedIcon,
  },
  due_today: {
    label: "Due today",
    color: "warning",
    accent: "warning.main",
    icon: ScheduleRoundedIcon,
  },
  upcoming: {
    label: "Upcoming",
    color: "info",
    accent: "info.main",
    icon: EventRoundedIcon,
  },
};

const getTransactionTitle = (transaction: HomePlannedExpense): string =>
  transaction.description?.trim()
  || transaction.vendor?.name?.trim()
  || transaction.category?.name?.trim()
  || `Planned expense #${transaction.id}`;

const getRequestErrorMessage = (error: AxiosError | null): string => {
  if (!error) return "Unable to update this planned expense.";
  const payload = error.response?.data;
  if (Array.isArray(payload)) {
    const message = payload.find((item) => (
      item && typeof item === "object" && "message" in item && typeof item.message === "string"
    ));
    if (message && typeof message === "object" && "message" in message) {
      return String(message.message);
    }
  }
  if (payload && typeof payload === "object" && "message" in payload) {
    return String(payload.message);
  }
  return error.message || "Unable to update this planned expense.";
};

const HomePlannedExpenses = ({ compact = false }: HomePlannedExpensesProps) => {
  const accessLoaded = useAppSelector((state) => state.accessControl.loaded);
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);
  const roleSlug = useAppSelector((state) => state.session.roleSlug);
  const transactionAccess = useModuleAccess(PAGE_SLUGS.financeTransactions);
  const recurringAccess = useModuleAccess(PAGE_SLUGS.financeRecurring);
  const enabled = canLoadHomePlannedExpenses({
    accessLoaded,
    financePageAllowed: allowedPageSlugs.has(PAGE_SLUGS.finance),
    canViewTransactions: transactionAccess.canView,
    roleSlug,
  });
  const query = useHomePlannedExpenses({ enabled, limit: compact ? 4 : 8 });
  const actionMutation = usePlannedExpenseAction();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [paidByUserId, setPaidByUserId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const data = query.data;
  const transactions = data?.data ?? [];
  const eligiblePayers = data?.options?.eligiblePayers ?? [];

  if (!enabled || (!query.isLoading && !query.error && transactions.length === 0)) {
    return null;
  }

  const canActOn = (transaction: HomePlannedExpense): boolean =>
    transactionAccess.canUpdate && (!isRecurringExpense(transaction) || recurringAccess.canUpdate);

  const openAction = (action: PlannedExpenseAction, transaction: HomePlannedExpense) => {
    setActionError(null);
    setPaidByUserId("");
    setPaymentDate(data?.meta.today ?? transaction.date);
    setPendingAction({ action, transaction });
  };

  const closeAction = () => {
    if (actionMutation.isPending) return;
    setPendingAction(null);
    setActionError(null);
  };

  const selectPaymentAction = (
    _event: MouseEvent<HTMLElement>,
    action: PlannedExpenseAction | null,
  ) => {
    if (action !== "pay" && action !== "staff_paid") return;
    setPendingAction((current) => current ? { ...current, action } : current);
    setPaidByUserId("");
    setActionError(null);
  };

  const performAction = async () => {
    if (!pendingAction || !canActOn(pendingAction.transaction)) return;
    if (!paymentDate) {
      setActionError("Select the date when the payment happened.");
      return;
    }
    if (pendingAction.action === "staff_paid" && !paidByUserId) {
      setActionError("Select the staff member who paid this expense.");
      return;
    }
    try {
      setActionError(null);
      await actionMutation.mutateAsync({
        id: pendingAction.transaction.id,
        action: pendingAction.action,
        paymentDate,
        ...(pendingAction.action === "staff_paid" ? { paidByUserId: Number(paidByUserId) } : {}),
      });
      const label = pendingAction.action === "pay"
        ? "marked as paid"
        : "sent to staff reimbursement";
      setSuccessMessage(`${getTransactionTitle(pendingAction.transaction)} was ${label}.`);
      setPendingAction(null);
    } catch (error) {
      setActionError(getRequestErrorMessage(error as AxiosError));
    }
  };

  const confirmLabel = pendingAction?.action === "staff_paid"
    ? "Send to reimbursement"
    : "Mark as paid";

  return (
    <>
      <Paper
        component="section"
        aria-labelledby="home-planned-expenses-title"
        elevation={0}
        sx={{
          mx: compact ? { xs: 1, md: 2 } : 0,
          p: { xs: 1.5, sm: 2.25, lg: compact ? 2.25 : 3 },
          border: "1px solid",
          borderColor: "divider",
          borderRadius: { xs: 3, sm: 4 },
          bgcolor: "background.paper",
          boxShadow: "0 12px 34px rgba(15, 23, 42, 0.06)",
        }}
      >
        <Stack spacing={{ xs: 1.75, sm: 2.25 }} alignItems="center">
          <Box
            sx={{
              width: "100%",
              display: { xs: "flex", sm: "grid" },
              gridTemplateColumns: { sm: "minmax(0, 1fr) auto minmax(0, 1fr)" },
              alignItems: "center",
              justifyContent: { xs: "space-between" },
              gap: 1,
            }}
          >
            <Typography
              id="home-planned-expenses-title"
              component="h2"
              variant={compact ? "subtitle1" : "h6"}
              fontWeight={850}
              textAlign={{ xs: "left", sm: "center" }}
              sx={{
                gridColumn: { sm: 2 },
                flex: { xs: "1 1 auto" },
                minWidth: 0,
                fontSize: { xs: "1rem", sm: compact ? "1rem" : "1.25rem" },
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Planned payments
            </Typography>
            <Button
              component={RouterLink}
              to="/finance/transactions"
              size="small"
              endIcon={<ArrowForwardRoundedIcon />}
              sx={{
                gridColumn: { sm: 3 },
                justifySelf: { sm: "end" },
                flexShrink: 0,
                minWidth: 0,
                minHeight: 32,
                px: { xs: 0.5, sm: 1 },
                fontSize: { xs: "0.72rem", sm: "0.8125rem" },
                whiteSpace: "nowrap",
                "& .MuiButton-endIcon": {
                  ml: { xs: 0.35, sm: 0.75 },
                  "& svg": { fontSize: { xs: 18, sm: 20 } },
                },
              }}
            >
              View all
            </Button>
          </Box>

          {query.isLoading ? (
            <Stack alignItems="center" spacing={1} sx={{ py: 3 }}>
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">Loading payments</Typography>
            </Stack>
          ) : query.error ? (
            <Stack alignItems="center" spacing={1.25} sx={{ py: 2, textAlign: "center" }}>
              <WarningAmberRoundedIcon color="warning" />
              <Typography variant="body2" color="text.secondary">
                Payments could not be loaded.
              </Typography>
              <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => void query.refetch()}>
                Retry
              </Button>
            </Stack>
          ) : (
            <Box
              sx={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: compact
                  ? {
                    xs: "minmax(0, 1fr)",
                    sm: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(3, minmax(0, 1fr))",
                    xl: "repeat(4, minmax(0, 1fr))",
                  }
                  : {
                    xs: "minmax(0, 1fr)",
                    sm: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(3, minmax(0, 1fr))",
                  },
                gap: { xs: 1.25, sm: 1.5 },
              }}
            >
              {transactions.map((transaction) => {
                const due = duePresentation[transaction.dueState];
                const DueIcon = due.icon;
                const actionable = canActOn(transaction);
                return (
                  <Paper
                    key={transaction.id}
                    variant="outlined"
                    sx={{
                      position: "relative",
                      overflow: "hidden",
                      p: { xs: 1.75, sm: 2 },
                      borderRadius: 3,
                      borderColor: "divider",
                      bgcolor: "background.paper",
                      "&::before": {
                        content: '""',
                        position: "absolute",
                        inset: "0 0 auto",
                        height: 4,
                        bgcolor: due.accent,
                      },
                    }}
                  >
                    <Stack
                      alignItems="center"
                      spacing={1.5}
                      textAlign="center"
                    >
                      <Stack alignItems="center" spacing={1.1} sx={{ width: "100%", minWidth: 0 }}>
                        <Chip
                          size="small"
                          color={due.color}
                          variant="outlined"
                          icon={<DueIcon />}
                          label={`${due.label} · ${formatDate(transaction.date)}`}
                          sx={{ fontWeight: 750 }}
                        />
                        <Typography
                          variant="subtitle2"
                          fontWeight={850}
                          sx={{
                            lineHeight: 1.35,
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 2,
                            overflow: "hidden",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {getTransactionTitle(transaction)}
                        </Typography>
                        <Typography
                          variant="h5"
                          component="p"
                          fontWeight={900}
                          sx={{ letterSpacing: -0.5, overflowWrap: "anywhere" }}
                        >
                          {formatMoney(transaction.amountMinor, transaction.currency)}
                        </Typography>
                      </Stack>
                      {actionable && (
                        <Button
                          variant="contained"
                          startIcon={<PaymentsRoundedIcon />}
                          onClick={() => openAction("pay", transaction)}
                          sx={{ width: "100%", maxWidth: 250, minHeight: 42, borderRadius: 2.25 }}
                        >
                          Record payment
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Box>
          )}
        </Stack>
      </Paper>

      <Dialog
        open={Boolean(pendingAction)}
        onClose={closeAction}
        fullWidth
        maxWidth="xs"
        aria-labelledby="planned-payment-dialog-title"
        sx={{
          "& .MuiDialog-paper": {
            m: { xs: 1.5, sm: 4 },
            width: { xs: "calc(100% - 24px)", sm: "100%" },
            maxHeight: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" },
            borderRadius: { xs: 3, sm: 4 },
          },
        }}
      >
        <DialogTitle
          id="planned-payment-dialog-title"
          textAlign="center"
          fontWeight={850}
          sx={{ pb: 0.5 }}
        >
          Record payment
        </DialogTitle>
        <DialogContent>
          {pendingAction && (
            <Stack alignItems="center" spacing={2} sx={{ pt: 1, textAlign: "center" }}>
              <Box sx={{ width: "100%" }}>
                <Typography
                  variant="h4"
                  component="p"
                  fontWeight={900}
                  sx={{ letterSpacing: -0.75, overflowWrap: "anywhere" }}
                >
                  {formatMoney(pendingAction.transaction.amountMinor, pendingAction.transaction.currency)}
                </Typography>
                <Typography variant="subtitle2" fontWeight={750} sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                  {getTransactionTitle(pendingAction.transaction)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Due {formatDate(pendingAction.transaction.date)}
                </Typography>
              </Box>

              <ToggleButtonGroup
                    exclusive
                    fullWidth
                    value={pendingAction.action}
                    onChange={selectPaymentAction}
                    aria-label="Payment source"
                    sx={{
                      "& .MuiToggleButton-root": {
                        minHeight: 46,
                        gap: 0.75,
                        borderRadius: 2,
                        px: { xs: 1, sm: 1.5 },
                        textTransform: "none",
                        fontWeight: 750,
                      },
                    }}
                  >
                    <ToggleButton value="pay" aria-label="Company funds">
                      <PaymentsRoundedIcon fontSize="small" />
                      Company funds
                    </ToggleButton>
                    {eligiblePayers.length > 0 && (
                      <ToggleButton value="staff_paid" aria-label="Staff member">
                        <PersonRoundedIcon fontSize="small" />
                        Staff member
                      </ToggleButton>
                    )}
              </ToggleButtonGroup>

              <TextField
                type="date"
                label="Payment date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ "aria-label": "Payment date" }}
                required
                fullWidth
                size="small"
              />

              {pendingAction.action === "staff_paid" && (
                <FormControl fullWidth required size="small">
                  <InputLabel id="planned-expense-payer-label">Paid by</InputLabel>
                  <Select
                    labelId="planned-expense-payer-label"
                    label="Paid by"
                    value={paidByUserId}
                    onChange={(event) => setPaidByUserId(String(event.target.value))}
                  >
                    {eligiblePayers.map((payer) => (
                      <MenuItem key={payer.userId} value={String(payer.userId)}>
                        {payer.fullName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {actionError && <Alert severity="error" sx={{ width: "100%" }}>{actionError}</Alert>}

              <Button
                component={RouterLink}
                to={`/finance/transactions?transactionModal=edit&transactionId=${pendingAction.transaction.id}`}
                size="small"
                startIcon={<EditRoundedIcon />}
              >
                Details
              </Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            px: { xs: 2, sm: 3 },
            pb: { xs: 2, sm: 3 },
            pt: 1,
            justifyContent: "center",
            flexDirection: { xs: "column-reverse", sm: "row" },
            gap: 1,
            "& > :not(style) ~ :not(style)": { ml: 0 },
          }}
        >
          <Button
            onClick={closeAction}
            disabled={actionMutation.isPending}
            sx={{ width: { xs: "100%", sm: 130 }, minHeight: 42 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => void performAction()}
            disabled={actionMutation.isPending}
            startIcon={actionMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ width: { xs: "100%", sm: "auto" }, minWidth: { sm: 150 }, minHeight: 42 }}
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(successMessage)}
        autoHideDuration={4500}
        onClose={() => setSuccessMessage(null)}
        message={successMessage}
      />
    </>
  );
};

export default HomePlannedExpenses;
