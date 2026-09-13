import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InvitationResponse } from "@/components/invitation-response";
export default async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;const {data:{user}}=await (await createClient()).auth.getUser();if(!user)redirect(`/login?next=${encodeURIComponent(`/convites/coproducao?token=${token??""}`)}`);return <InvitationResponse token={token??""}/>;}
