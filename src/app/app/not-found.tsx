import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";

export default function AppNotFound() {
  return (
    <div className="mx-auto mt-14 max-w-md">
      <div className="card animate-pop p-8 text-center">
        <p className="bg-gradient-to-r from-pulse-300 via-cyan-300 to-lime-300 bg-clip-text font-mono text-5xl font-bold text-transparent">
          404
        </p>
        <h1 className="panel-title mt-3 text-lg font-bold text-mist-100">Nothing at this address</h1>
        <p className="mt-2 text-[13px] leading-5 text-mist-400">
          This route or record doesn&apos;t exist in your workspace.
        </p>
        <Link href="/app" className="mt-5 inline-block">
          <Button>
            <Icon name="pulse" size={14} /> Back to mission control
          </Button>
        </Link>
      </div>
    </div>
  );
}