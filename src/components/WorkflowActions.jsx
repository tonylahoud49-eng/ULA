import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function WorkflowActions({ children, label = "Workflow actions" }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(96);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setHeight(entry.target.getBoundingClientRect().height));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return <>
    <div aria-hidden="true" style={{ height }} />
    {createPortal(
      <section ref={ref} aria-label={label} className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] lg:left-[272px]" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-[1536px] flex-wrap items-center justify-between gap-2 [&_button]:whitespace-normal [&_button]:h-auto [&_button]:min-h-10 [&_button]:py-2">
          {children}
        </div>
      </section>, document.body,
    )}
  </>;
}
