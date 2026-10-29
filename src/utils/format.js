export const money = (value, currency) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);

export const count = (value) => value.toLocaleString("en-GB");
