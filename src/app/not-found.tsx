import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="card animate-pop max-w-md p-8 text-center">
        <p className="bg-gradient-to-r from-pulse-300 via-cyan-300 to-lime-300 bg-clip-text font-mono text-6xl font-bold text-transparent">
          404
        </p>
        <h1 className="panel-title mt-3 text-lg font-bold text-mist-100">This coordinate isn&apos;t on the map</h1>
        <p className="mt-2 text-[13px] leading-5 text-mist-400">
          The page you asked for doesn&apos;t exist — or it belongs to a workspace you can&apos;t see. Check the address or choose another workspace.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/app">
            <Button>
              <Icon name="pulse" size={14} /> Mission control
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline">Sign in</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}