#!/usr/bin/env bash
set -euo pipefail
# Runs exclusively against the disposable CI PostgreSQL service.
# This is not a substitute for provider Sandbox or customer E2E.
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
pg() { psql -X -A -t -v ON_ERROR_STOP=1 "$@"; }

# Two independent grants race on the SAME email but different documents.
email_fp="$(printf 'e%.0s' {1..64})"
doc_one="$(printf 'f%.0s' {1..64})"
doc_two="$(printf '1%.0s' {1..64})"
pg -c "select public.reserve_nexus_crm_trial('60000000-0000-4000-8000-000000000021','$email_fp','$doc_one',15)" > "$temp_dir/trial_a" & p1=$!
pg -c "select public.reserve_nexus_crm_trial('60000000-0000-4000-8000-000000000022','$email_fp','$doc_two',30)" > "$temp_dir/trial_b" & p2=$!
wait "$p1"; wait "$p2"
successes="$(cat "$temp_dir/trial_a" "$temp_dir/trial_b" | grep -xc t || true)"
failures="$(cat "$temp_dir/trial_a" "$temp_dir/trial_b" | grep -xc f || true)"
[[ "$successes" == 1 && "$failures" == 1 ]] || { echo 'FAIL: concurrent trial grants must be one success, one duplicate'; exit 1; }
[[ "$(pg -c "select count(*) from public.nexus_crm_trial_claims where email_fingerprint='$email_fp'")" == 1 ]] || { echo 'FAIL: trial ledger duplicated'; exit 1; }

# A standalone, synthetic Asaas sale used only for racing reservation and claim.
pg -c "insert into public.nexus_sales(id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,billing_cycle_months,checkout_amount_cents,asaas_checkout_id,registration_number,email) values ('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','checkout_created','asaas','sandbox','site-captacao','recurring',1,7900,'plink_race123','66666666000199','race@example.test')" >/dev/null
pg -c "insert into public.nexus_payment_webhook_events(provider_event_id,provider,event_type,payload) values ('asaas:evt_race123456','asaas','PAYMENT_RECEIVED','{\"event\":\"PAYMENT_RECEIVED\",\"resource\":{\"id\":\"pay_race123\",\"paymentLink\":\"plink_race123\",\"subscription\":\"sub_race123\",\"billingType\":\"PIX\",\"value\":79}}'::jsonb)" >/dev/null
reserve="select public.reserve_nexus_crm_asaas_verified_payment('50000000-0000-4000-8000-000000000003','asaas:evt_race123456','pay_race123','sub_race123',7900,'PIX')->>'decision'"
pg -c "$reserve" > "$temp_dir/pay_a" & p1=$!
pg -c "$reserve" > "$temp_dir/pay_b" & p2=$!
wait "$p1"; wait "$p2"
[[ "$(cat "$temp_dir/pay_a")" == reserved_for_review && "$(cat "$temp_dir/pay_b")" == reserved_for_review ]] || { echo 'FAIL: reservation race'; exit 1; }
[[ "$(pg -c "select count(*) from public.nexus_crm_asaas_verified_payments where provider_payment_id='pay_race123'")" == 1 ]] || { echo 'FAIL: duplicated Asaas payment'; exit 1; }

# Only ONE parallel worker may advance checkout_created -> paid.
claim="select public.claim_nexus_crm_asaas_provisioning('50000000-0000-4000-8000-000000000003','pay_race123')->>'decision'"
pg -c "$claim" > "$temp_dir/claim_a" & p1=$!
pg -c "$claim" > "$temp_dir/claim_b" & p2=$!
wait "$p1"; wait "$p2"
[[ "$(cat "$temp_dir/claim_a" "$temp_dir/claim_b" | grep -xc provision_ready || true)" == 1 ]] || { echo 'FAIL: concurrent double financial claim'; exit 1; }
[[ "$(cat "$temp_dir/claim_a" "$temp_dir/claim_b" | grep -xc already_claimed || true)" == 1 ]] || { echo 'FAIL: claim retry did not idempotently return'; exit 1; }
[[ "$(pg -c "select count(*) from public.nexus_sales where id='50000000-0000-4000-8000-000000000003' and sale_status='paid'")" == 1 ]] || { echo 'FAIL: unexpected sale state'; exit 1; }
echo 'PASS: concurrent trial, Asaas reservation, and financial claim (PostgreSQL 17)'
