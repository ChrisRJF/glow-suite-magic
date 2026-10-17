import { describe, expect, it } from "vitest";
import { appointmentRiskHistory, loadAppointmentRiskHistory, type RiskAppointment } from "../../docs/prepared-patches/no-show-risk/appointmentRiskHistory";
import { calculateNoShowRisk } from "../../docs/prepared-patches/no-show-risk/noShowRisk";
import { decideDeposit } from "../../docs/prepared-patches/no-show-risk/depositDecision";

const row = (id: string, status: string): RiskAppointment => ({ id, status, user_id: "tenant", customer_id: "customer" });
const derive = (rows: RiskAppointment[], complete = true) => appointmentRiskHistory(rows, "tenant", "customer", complete);
describe("prepared appointment evidence", () => {
  it("uses explicit completed/no-show aliases only", () => {
    const rows = ["voltooid", "completed", "afgerond", "done", "no-show", "no_show", "noshow", "niet_verschenen"].map((s,i) => row(String(i),s));
    expect(derive(rows)).toEqual({ completed: 4, noShows: 4, lateCancellations: 0 });
  });
  it("four cancellations have zero penalty even with changed timestamps", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ ...row(String(i), "geannuleerd"), updated_at: "2026-10-17", created_at: "2020-01-01" }));
    expect(calculateNoShowRisk({ verifiedHistory: derive(rows) })).toMatchObject({ score: 0, isHigh: false });
    expect(derive(rows)?.lateCancellations).toBe(0);
  });
  it("past pending/confirmed/unknown outcomes are not completed or no-shows", () => {
    expect(derive([row("1", "confirmed"), row("2", "pending_confirmation"), row("3", "unknown")])).toEqual({ completed: 0, noShows: 0, lateCancellations: 0 });
  });
  it("two explicit no-shows reach high and completed visits dilute risk", () => {
    expect(calculateNoShowRisk({ verifiedHistory: derive([row("1", "no_show"),row("2","no_show")]) }).score).toBe(60);
    const rows = [row("1","no_show"),row("2","no_show"), ...Array.from({length:98},(_,i)=>row(String(i+3),"voltooid"))];
    expect(calculateNoShowRisk({ verifiedHistory: derive(rows) }).score).toBe(2);
  });
  it("incomplete, duplicate or foreign history fails neutral", () => {
    expect(derive([row("1","no_show")],false)).toBeUndefined();
    expect(derive([row("1","no_show"),row("1","no_show")])).toBeUndefined();
    expect(derive([{...row("1","no_show"),user_id:"foreign"}])).toBeUndefined();
    expect(derive([{...row("1","no_show"),customer_id:"foreign"}])).toBeUndefined();
  });
  it("loads beyond response limit with explicit tenant/customer bounds", async () => {
    const rows = Array.from({length:1002},(_,i)=>row(String(i),i<2?"no_show":"completed"));
    const calls: number[] = [];
    const h = await loadAppointmentRiskHistory(async scope => {
      expect(scope.tenantId).toBe("tenant"); expect(scope.customerId).toBe("customer");
      calls.push(scope.from);
      return { data:rows.slice(scope.from,scope.to+1),error:null,count:1002 };
    },"tenant","customer");
    expect(calls).toEqual([0,1000]); expect(h?.completed).toBe(1000);
  });
  it.each(["error","throw","missing-count","truncated","foreign","changing-count"])("%s read cannot force a deposit", async mode => {
    let calls=0;
    const h = await loadAppointmentRiskHistory(async () => {
      calls++;
      if(mode==="throw") throw new Error("read failed");
      if(mode==="changing-count") return {data:Array.from({length:1000},(_,i)=>row(String(i),"no_show")),error:null,count:calls===1?1001:1002};
      return {data:mode==="foreign"?[{...row("1","no_show"),user_id:"foreign"}]:[row("1","no_show")],error:mode==="error"?"failed":null,count:mode==="missing-count"?null:mode==="truncated"?2:1};
    },"tenant","customer");
    expect(h).toBeUndefined();
    expect(decideDeposit({settings:{deposit_new_client:false,full_prepay_threshold:0},customer:{verifiedHistory:h},isNewCustomer:false,servicePriceEuros:80}).required).toBe(false);
  });
  it("empty complete read remains insufficient", async () => {
    const h=await loadAppointmentRiskHistory(async()=>({data:[],error:null,count:0}),"tenant","customer");
    expect(calculateNoShowRisk({verifiedHistory:h}).hasSufficientData).toBe(false);
  });
});