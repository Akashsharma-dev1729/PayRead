import {processWebhook} from '@/lib/server/payment-service';
import {serverDb,readBody,json,failure} from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(req:Request){try{return json(await processWebhook(serverDb(),await readBody(req,262144),req.headers.get('x-razorpay-signature')));}catch(e){return failure(e);}}
