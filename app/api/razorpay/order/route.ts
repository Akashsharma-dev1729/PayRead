import {createOrder} from '@/lib/server/payment-service';
import {serverDb,input,json,failure} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(req:Request){try{return json(await createOrder(serverDb(),await input(req)));}catch(e){return failure(e);}}
