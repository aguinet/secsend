import struct
import hashlib
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# AES-GCM uses a 4-byte counter. It means we can't process chunks with more
# than 2**32 bytes (~4GB).
class GCMIV:
    IV_LEN = 12
    def __init__(self, iv_base: bytes):
        assert(len(iv_base) == self.IV_LEN)
        self._iv_base = iv_base

    def chunk_iv(self, idx):
        # We add idx as a 64-bit little endian integer to the first 8 bytes of
        # iv_base
        n, = struct.unpack("<Q", self._iv_base[:8])
        n += idx
        n &= 0xFFFFFFFFFFFFFFFF
        return struct.pack("<Q", n) + self._iv_base[8:]

def DeriveKey(key: bytes, prefix: bytes):
    H = hashlib.sha256(prefix)
    H.update(key)
    return H.digest()

def DeriveFileKey(key: bytes):
    return DeriveKey(key, b"secsend_file")

def DeriveMetadataKey(key: bytes):
    return DeriveKey(key, b"secsend_meta")

class AESGCMChunks:
    TAG_SIZE = 16
    IV_LEN = GCMIV.IV_LEN

    def __init__(self, iv: bytes, key: bytes, encrypt: bool):
        self._iv = GCMIV(iv)
        self._aes = AESGCM(DeriveFileKey(key))
        self._aes_metadata = AESGCM(DeriveMetadataKey(key))
        self._func = self._aes.encrypt if encrypt else self._aes.decrypt
        self.encrypt = encrypt
        self._chunk_idx = 0

    def out_chunk_size(self, in_chunk_size):
        if self.encrypt:
            return in_chunk_size + self.TAG_SIZE
        return in_chunk_size - self.TAG_SIZE

    def out_size(self, in_size: int, decrypted_chunk_size: int) -> int:
        if self.encrypt:
            in_chunk_size = decrypted_chunk_size
            out_chunk_size = decrypted_chunk_size+self.TAG_SIZE
        else:
            in_chunk_size = decrypted_chunk_size+self.TAG_SIZE
            out_chunk_size = decrypted_chunk_size

        nchunks = in_size//in_chunk_size
        ret = nchunks*out_chunk_size;
        rem = in_size%in_chunk_size;
        if (rem > 0):
            if self.encrypt:
                rem += self.TAG_SIZE
            else:
                rem -= self.TAG_SIZE
            ret += rem
        return ret;

    def _chunk_iv(self):
        return self._iv.chunk_iv(self._chunk_idx)

    def seek_chunk_idx(self, idx):
        self._chunk_idx = idx

    def process(self, data):
        assert(len(data) < (1<<32))
        ret = self._func(self._chunk_iv(), data, None)
        self._chunk_idx += 1
        return ret

    def encr_sign_metadata(self, idx: int, toencr: bytes, tosign: bytes) -> bytes:
        return self._aes_metadata.encrypt(self._iv.chunk_iv(idx), toencr, tosign)

    def decr_verify_metadata(self, idx: int, encr: bytes, signed: bytes) -> bytes:
        return self._aes_metadata.decrypt(self._iv.chunk_iv(idx), encr, signed)


def SignKey(key: bytes, nonce: bytes) -> bytes:
    H = hashlib.sha256(b"secsend_sign")
    H.update(nonce)
    H.update(key)
    return H.digest()

def VerifyKey(sign: bytes, key: bytes, nonce: bytes) -> bool:
    return SignKey(key, nonce) == sign
