"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn, initials } from "@/lib/utils";
import { Icon, type IconName } from "../icons";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-all duration-150 select-none disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-pulse-400 to-pulse-600 text-white shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_20px_-8px_rgba(124,92,255,0.7)] hover:from-pulse-300 hover:to-pulse-500 active:scale-[0.98]",
        outline: "border border-line bg-ink-800/60 text-mist-200 hover:border-pulse-600 hover:text-white hover:bg-ink-750",
        ghost: "text-mist-400 hover:text-mist-100 hover:bg-ink-700/60",
        danger: "bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25",
        success: "bg-lime-400/15 text-lime-300 border border-lime-400/30 hover:bg-lime-400/25",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3 text-[13px]",
        md: "h-9.5 px-4 text-sm",
        icon: "h-8 w-8 p-0",
        iconSm: "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field", className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("field resize-none", className)} {...props} />;
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("field cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}

export function Badge({
  children,
  color,
  className,
  dot,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        className,
      )}
      style={
        color
          ? { color, borderColor: `${color}44`, background: `${color}14` }
          : { color: "#93a1bc", borderColor: "#202e52", background: "#111a30" }
      }
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color ?? "#93a1bc" }} />}
      {children}
    </span>
  );
}

export function Avatar({
  name,
  hue,
  size = 26,
  className,
  ring,
}: {
  name: string;
  hue: number;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        color: `hsl(${hue} 90% 82%)`,
        background: `linear-gradient(135deg, hsl(${hue} 65% 26%), hsl(${(hue + 40) % 360} 65% 17%))`,
        border: `1px solid hsl(${hue} 70% 45% / 0.5)`,
        boxShadow: ring ? `0 0 0 2px #0a101f, 0 0 0 3.5px hsl(${hue} 70% 50% / 0.6)` : undefined,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg className={cn("animate-spin", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  icon = "layers",
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-750 text-pulse-300">
        <Icon name={icon} size={20} />
      </span>
      <p className="panel-title text-sm font-semibold text-mist-200">{title}</p>
      {body && <p className="max-w-sm text-[13px] leading-5 text-mist-500">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function Meter({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-700", className)}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color, boxShadow: `0 0 8px ${color}88` }}
      />
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-500">{children}</label>;
}