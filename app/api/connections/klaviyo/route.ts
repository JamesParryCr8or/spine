import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { supabase, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  return { supabase, response: null };
}
export async function GET() {
  const { supabase, response } = await requireUser(); if (response) return response;
  const { data, error } = await supabase.from("data_connections").select("provider,status,external_account_id,external_account_name,last_verified_at,last_error").eq("provider","klaviyo").maybeSingle();
  if (error) return NextResponse.json({ error:error.message },{status:500});
  return NextResponse.json({ connection:data });
}
export async function POST(request:Request) {
  const { supabase, response } = await requireUser(); if(response) return response;
  const { apiKey }=await request.json().catch(()=>({})) as {apiKey?:string};
  const key=apiKey?.trim(); if(!key) return NextResponse.json({error:"A Klaviyo private API key is required"},{status:400});
  const verified=await fetch("https://a.klaviyo.com/api/accounts/",{headers:{Authorization:`Klaviyo-API-Key ${key}`,revision:"2025-01-15"},cache:"no-store"});
  const payload=await verified.json().catch(()=>({})) as {data?:Array<{id:string;attributes?:{contact_information?:{organization_name?:string}}}>;errors?:Array<{detail?:string}>};
  if(!verified.ok)return NextResponse.json({error:payload.errors?.[0]?.detail??"Klaviyo rejected this private API key"},{status:400});
  const account=payload.data?.[0]; if(!account)return NextResponse.json({error:"No Klaviyo account was returned for this key"},{status:400});
  const {data,error}=await supabase.rpc("save_data_connection",{connection_provider:"klaviyo",access_token:key,account_id:account.id,account_name:account.attributes?.contact_information?.organization_name??account.id});
  if(error)return NextResponse.json({error:error.message},{status:500});
  return NextResponse.json({connection:Array.isArray(data)?data[0]:data});
}
export async function DELETE(){const {supabase,response}=await requireUser();if(response)return response;const {error}=await supabase.rpc("delete_data_connection",{connection_provider:"klaviyo"});if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({success:true});}