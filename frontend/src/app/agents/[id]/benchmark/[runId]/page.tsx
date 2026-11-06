"use client";
import { useParams } from "next/navigation";
import { BenchmarkRunner } from "@/components/BenchmarkRunner";

export default function BenchmarkPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Benchmark report</h1>
      <BenchmarkRunner agentId={id} runId={runId} />
    </div>
  );
}
