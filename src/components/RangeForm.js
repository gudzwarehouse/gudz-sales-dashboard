import * as React from "react";

const RangeForm = ({ onApply }) => {
  const [draft, setDraft] = React.useState({ from: "", to: "" });
  const update = (field) => (event) =>
    setDraft({ ...draft, [field]: event.target.value });

  return (
    <form
      className="range-form"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <input
        type="date"
        required
        value={draft.from}
        max={draft.to || undefined}
        onChange={update("from")}
      />
      <span>to</span>
      <input
        type="date"
        required
        value={draft.to}
        min={draft.from || undefined}
        onChange={update("to")}
      />
      <button type="submit">Apply</button>
    </form>
  );
};

export default RangeForm;
