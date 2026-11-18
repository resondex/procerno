/** The quiet "seldom raised" tag on an argument row (ruling 1, 2026-11-18): the argument comes up more on one side,
 * but in few of the answers on either side - the row stays, marked, in the style of the cards' "fixed" tag. */
export function SeldomTag() {
  return (
    <span
      title="Few answers raise this argument at all - read the gap as a hint, not a finding"
      className="ml-1.5 whitespace-nowrap rounded-full border border-line px-1.5 align-[1px] text-[11px] font-normal text-ink-2"
    >
      seldom raised
    </span>
  );
}
