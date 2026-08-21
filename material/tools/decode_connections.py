import base64,struct

def decode_connections_v2(b64):
    raw=base64.b64decode(b64)
    if len(raw)%24: raise ValueError("connections_v2 byte length is not divisible by 24")
    out=[]
    for off in range(0,len(raw),24):
        location_id,typ,x1,y1,x2,y2=struct.unpack_from(">iiiiii",raw,off)
        out.append((location_id,typ,x1/100,y1/100,x2/100,y2/100))
    return out
