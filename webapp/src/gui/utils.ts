export function debounce<R>(func: () => Promise<R>, wait: number) {
  let timeout: any = null;
  let cbs_success: any = [];
  let cbs_reject: any = [];

  const doCall = () => {
    timeout = null;
    // We copy & clean the shared state **before** calling the
    // asynchronous function, as we could yield back into the
    // debounced function, which would modify the state during the
    // call, hence ending up in a race condition!
    // We then clear this shared state so that we can properly
    // register the next round.
    const local_cbs_success = [...cbs_success];
    const local_cbs_reject = [...cbs_reject];
    cbs_success = [];
    cbs_reject = [];

    func().then((res) => {
      for (const cb of local_cbs_success) {
        cb(res);
      }
    }).catch((e) => {
      for (const cb of local_cbs_reject) {
        cb(e);
      }
    });
  };

  return (): Promise<R> => {
    return new Promise((resolve, reject) => {
      cbs_success.push(resolve);
      cbs_reject.push(reject);
      if (timeout === null) {
        timeout = setTimeout(doCall, wait);
      }
    });
  };
}

export function formatSize(size: number) {
  let ret;
  let unit;
  if (size >= 1000000000) {
    ret = (size/1000000000);
    unit = "GB";
  } else if (size >= 1000000) {
    ret = (size/1000000);
    unit = "MB";
  } else if (size >= 1000) {
    ret = (size/1000);
    unit = "KB";
  } else {
    ret = size;
    unit = "B";
  }
  return ret.toFixed(2) + " " + unit;
}

function plural(s: string, n: number) {
  return s + ((n>1) ? "s":"");
}

export function formatDuration(seconds: number) {
  if (seconds == 0) {
    return "No limit";
  }
  let seconds_ = seconds;
  let ret = "";
  if (seconds_ >= 86400) { // 1 day
    const days = Math.floor(seconds_/86400);
    ret += days + " " + plural("day",days) + " ";
    seconds_ -= days*86400;
  }
  if (seconds_ >= 3600) { // 1 hour
    const hours = Math.floor(seconds_/3600);
    ret += hours + " " + plural("hour", hours) + " ";
    seconds_ -= hours*3600;
  }
  if (seconds_ >= 60) { // 1mn
    const mn = Math.floor(seconds_/60);
    ret += mn + " " + plural("minute", mn) + " ";
    seconds_ -= mn*60;
  }
  if (seconds_ > 0) {
    ret += seconds_ + " " + plural("second", seconds_);
  }
  return ret;
}

export function formatTime(time_sec: number) {
  time_sec = Math.round(time_sec);
  const hours = Math.floor(time_sec/3600);
  time_sec -= hours*3600;
  const minutes = Math.floor(time_sec/60);
  time_sec -= minutes*60;
  const format = (n: number) => {
    return n.toLocaleString('en-US', {
      minimumIntegerDigits: 2,
      useGrouping: false
    });
  };
  return format(hours)+":"+format(minutes)+":"+format(time_sec);
}
