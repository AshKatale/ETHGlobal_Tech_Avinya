'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from '@/providers/Session';
import type { Agent, AgentDetail, Me } from './types';

export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/agents'), refetchInterval: 30_000 });

export const useAgent = (id: string) => useQuery({ queryKey: ['agent', id], queryFn: () => api<AgentDetail>(`/agents/${id}`), enabled: !!id });

/** The signed-in user (needs a session). */
export function useMe() {
  const { signedIn } = useSession();
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me', { auth: true }), enabled: signedIn });
}

import type { GithubRepo, GithubStatus } from './types';

export const useGithubStatus = () => {
  const { signedIn } = useSession();
  return useQuery({ queryKey: ['github-status'], queryFn: () => api<GithubStatus>('/github/status', { auth: true }), enabled: signedIn });
};

export const useGithubRepos = (enabled: boolean) =>
  useQuery({ queryKey: ['github-repos'], queryFn: () => api<GithubRepo[]>('/github/repos', { auth: true }), enabled, staleTime: 60_000 });

import type { DesignDetail } from './types';

/** How the contract was designed, plus its on-chain proof. Polls while a sub-agent leg may still be added. */
export const useDesign = (id: string, settled: boolean) =>
  useQuery({ queryKey: ['design', id], queryFn: () => api<DesignDetail>(`/agreements/${id}/design`), refetchInterval: settled ? false : 15_000, staleTime: 10_000 });
