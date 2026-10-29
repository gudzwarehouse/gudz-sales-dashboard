import * as React from "react";
import "../styles/dashboard.css";
import logo from "../images/gudz-logo.webp";
import DatePicker from "../components/DatePicker";
import Header from "../components/Header";
import Notice from "../components/Notice";
import RangeForm from "../components/RangeForm";
import SalesReport from "../components/SalesReport";
import SectionHead from "../components/SectionHead";
import SkeletonGrid from "../components/SkeletonGrid";
import { RANGES } from "../constants/dashboard";
import { useSales } from "../hooks/useSales";

const buildQuery = (range, custom, date) => {
  if (range === "date") return date ? `from=${date}&to=${date}` : null;
  if (range !== "custom") return `range=${range}`;
  return custom ? `from=${custom.from}&to=${custom.to}` : null;
};

const IndexPage = () => {
  const [range, setRange] = React.useState("today");
  const [custom, setCustom] = React.useState(null);
  const [date, setDate] = React.useState("");
  const { data, error, loading, retry } = useSales(
    buildQuery(range, custom, date),
  );

  return (
    <main className="dash">
      <Header range={range} onChange={setRange} />
      {range === "date" && <DatePicker value={date} onPick={setDate} />}
      {range === "custom" && <RangeForm onApply={setCustom} />}
      <SectionHead
        title={RANGES[range].title}
        from={data?.from}
        to={data?.to}
      />

      {error && (
        <Notice error onRetry={retry}>
          Failed to load: {error}
        </Notice>
      )}
      {range === "date" && !date && (
        <Notice>Click a date in the calendar to see that day's sales.</Notice>
      )}
      {range === "custom" && !custom && (
        <Notice>Pick a start and end date, then press Apply.</Notice>
      )}
      {loading && <SkeletonGrid />}
      {data && <SalesReport channels={data.channels} onRetry={retry} />}
    </main>
  );
};

export default IndexPage;

export const Head = () => (
  <>
    <title>Gudz Sales Dashboard</title>
    <link rel="icon" href={logo} type="image/webp" />
  </>
);
