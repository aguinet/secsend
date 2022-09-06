import os

def sanitize_name(name):
    name = name.replace("../","_")
    name = name.replace("..\\","_")
    name = name.replace("\\","_")
    name = name.replace("/","_")
    return name

def get_nonexistant_file(path):
    org_path = path
    num = 0
    while True:
        if not os.path.exists(path):
            return path
        num += 1
        path = "%s.%d" % (org_path,num)

_BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'
# Adapted from numpy's base_repr
def to_base_36(num: int) -> str:
    assert(num >= 0)

    BASE = len(_BASE36_CHARS)
    res = []
    while num > 0:
        num, v = divmod(num, BASE)
        res.append(_BASE36_CHARS[v])
    return ''.join(reversed(res or '0'))
