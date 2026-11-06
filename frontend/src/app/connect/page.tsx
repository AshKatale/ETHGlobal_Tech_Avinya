"use client";
import { useRouter } from "next/navigation";
import { ConnectPanel } from "@/components/ConnectPanel";

export default function ConnectPage() {
  const router = useRouter();
  return <ConnectPanel pageHeading onDone={() => router.back()} />;
}
