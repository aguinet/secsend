import datetime

def timeout_ts(interval_s):
    if interval_s == 0:
        return 0
    # Always process date as UTC
    delta = datetime.timedelta(seconds=interval_s)
    expired = datetime.datetime.now(datetime.timezone.utc) + delta
    return expired.timestamp()

def ts_has_expired(timestamp):
    now = datetime.datetime.now(datetime.timezone.utc)
    expired = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc)
    return now >= expired
