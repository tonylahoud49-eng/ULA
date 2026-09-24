import React, { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger } from "@/components/ui/select";

export default function FormField({ label, children }) {
  const id = useId();
  const control = React.Children.only(children);
  const labeledControl = control.type === Select
    ? React.cloneElement(control, {}, React.Children.map(control.props.children, (child) => (
      React.isValidElement(child) && child.type === SelectTrigger ? React.cloneElement(child, { id }) : child
    )))
    : React.cloneElement(control, { id });
  return <div className="min-w-0"><Label htmlFor={id} className="text-xs font-semibold">{label}</Label><div className="mt-1.5">{labeledControl}</div></div>;
}
