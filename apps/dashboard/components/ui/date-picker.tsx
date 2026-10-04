import { Input } from "./input";

export function DatePicker(props: Omit<React.ComponentProps<typeof Input>, "type">) {
  return <Input type="date" {...props} />;
}
