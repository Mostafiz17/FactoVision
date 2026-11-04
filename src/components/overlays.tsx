"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as PopoverRx from "@radix-ui/react-popover";
import * as TooltipRx from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm animate-fade" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-ink-850 p-5 shadow-2xl animate-pop",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="panel-title text-base font-semibold text-mist-100">{title}</Dialog.Title>
              {subtitle && (
                <Dialog.Description className="mt-0.5 text-[13px] text-mist-500">{subtitle}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-mist-500 hover:bg-ink-700 hover:text-mist-200" aria-label="Close">
              <Icon name="x" size={16} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-[2px] animate-fade" />
        <Dialog.Content
          aria-label={label}
          className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-[560px] flex-col border-l border-line bg-ink-900 shadow-2xl animate-drawer"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-[190px] rounded-xl border border-line bg-ink-800 p-1.5 shadow-2xl animate-pop",
          className,
        )}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <Dropdown.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors",
        danger ? "text-rose-300 data-[highlighted]:bg-rose-500/15" : "text-mist-300 data-[highlighted]:bg-ink-700 data-[highlighted]:text-mist-100",
        className,
      )}
    >
      {children}
    </Dropdown.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-mist-600">{children}</Dropdown.Label>;
}
export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-line" />;
}

export const Popover = PopoverRx.Root;
export const PopoverTrigger = PopoverRx.Trigger;
export function PopoverContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <PopoverRx.Portal>
      <PopoverRx.Content
        align={align}
        sideOffset={8}
        className={cn("z-50 rounded-xl border border-line bg-ink-800 shadow-2xl animate-pop", className)}
      >
        {children}
      </PopoverRx.Content>
    </PopoverRx.Portal>
  );
}

export const TooltipProvider = TooltipRx.Provider;
export function Tip({ label, children, side = "top" }: { label: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipRx.Root>
      <TooltipRx.Trigger asChild>{children}</TooltipRx.Trigger>
      <TooltipRx.Portal>
        <TooltipRx.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-[260px] rounded-lg border border-line bg-ink-750 px-2.5 py-1.5 text-xs text-mist-200 shadow-xl animate-fade"
        >
          {label}
          <TooltipRx.Arrow className="fill-ink-750" />
        </TooltipRx.Content>
      </TooltipRx.Portal>
    </TooltipRx.Root>
  );
}