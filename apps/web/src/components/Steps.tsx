const steps = [
  {
    title: "Issue and accept",
    text: "A creditor records an invoice; the debtor accepts it on chain. Only accepted invoices can be paid or cancelled.",
  },
  {
    title: "Propose",
    text: "Any solver sends the clearing that cancels the most debt, with a bond. A better proposal replaces it until the round closes.",
  },
  {
    title: "Check",
    text: "The contract accepts a clearing only if every firm stops owing exactly as much as it stops being owed.",
  },
  {
    title: "Close and pay",
    text: "The best proposal is checked again and applied. Debtors pay what is left in the token; creditors withdraw it.",
  },
] as const;

/** The round, in the order it happens on chain. */
export function Steps() {
  return (
    <section className="band" aria-labelledby="how">
      <div className="band-head">
        <h2 id="how">One clearing round</h2>
        <p>
          The rule the contract checks, for every firm: <code>owes_less == is_owed_less</code>. A proposal that breaks it is
          refused, whoever sends it, so nobody has to trust the solver.
        </p>
      </div>
      <ol className="steps">
        {steps.map((step) => (
          <li key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
