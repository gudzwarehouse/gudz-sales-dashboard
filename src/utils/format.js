export const money = (value, currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);

export const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date(),
  );

export const count = (value) => value.toLocaleString("en-GB");
