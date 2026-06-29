// ----- Employees -----
// Hire staff for a specific business to boost its income multiplier AND its
// production speed. Stacks on top of managers, pro boosts and gem upgrades.

export const EMP_MAX = 12;
export const EMP_INCOME_PER = 0.1; // +10% business income per employee
export const EMP_SPEED_PER = 0.04; // +4% faster production per employee

export const EMPLOYEE_ROLES = [
  "Cashier",
  "Cook",
  "Server",
  "Manager Asst.",
  "Shift Lead",
  "Supervisor",
  "Trainer",
  "Operations",
  "Regional",
  "Director",
  "VP",
  "Partner",
];

export function employeeCost(managerCost: number, count: number): number {
  return Math.ceil(managerCost * 0.2 * Math.pow(1.7, count));
}

export function staffIncomeMult(count: number): number {
  return 1 + EMP_INCOME_PER * count;
}

export function staffSpeedMult(count: number): number {
  return 1 + EMP_SPEED_PER * count;
}
