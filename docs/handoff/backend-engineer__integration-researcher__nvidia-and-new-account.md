status: open
priority: normal
what: (1) NVIDIA: current askJson already sends chat_template_kwargs enable_thinking:false and that is verified to work (about 0.4 s tiny prompt vs 12 s with thinking). Optionally add response_format json_object as well; keep the Zod retry. (2) Payouts: pay-to-new-address gas cost is unverified. Until settled, make sure the agent payout address has an account (a plain relayer transfer first) and give release() a generous gas_limit (the working releases used 1,200,000 limit, 66.8k used).
evidence: docs/spike-results.md sections 1 and 5; spikes/nvidia-probe.mjs
acceptance: backend does not rely on release() creating an account
response:
