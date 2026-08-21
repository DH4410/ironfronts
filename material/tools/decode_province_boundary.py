import base64,struct

def decode_boundary(b64):
    raw=base64.b64decode(b64)
    vals=struct.unpack(">"+"H"*(len(raw)//2),raw)
    return list(zip(vals[0::2],vals[1::2]))

def decode_border_type_mask(b64):
    return list(base64.b64decode(b64))
