# Retire a legacy batch timer

Batch coordination now waits for owner reports and authorized provider events.
On resume, a recorded legacy schedule may still be active. Identify its exact
host, batch and schedule. Use applicable shutdown authority to stop it through
the owning host control and verify the observed result. If authority or control
is missing, surface the specific gap. Preserve unknown stop outcomes and any
state the schedule still reads until reconciled. Never reactivate or replace it.
Chat archival alone cannot verify shutdown.
