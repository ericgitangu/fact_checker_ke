import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): React.JSX.Element {
  return <button {...props} className={`btn btn-${variant} ${className}`.trim()} />;
}

export function LinkButton({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link href={href} className={`btn btn-${variant} ${className}`.trim()}>
      {children}
    </Link>
  );
}
