import sys
import progressbar

from secsend.client import DownloadURL

def get_progressbar(name, size):
    if name is None:
        name = ''
    widgets = [
            name + '  ', progressbar.Bar(),
            '  ', progressbar.ETA(),
            '  ', progressbar.FileTransferSpeed(),
    ]
    if size is None:
        size = progressbar.base.UnknownLength
    return progressbar.ProgressBar(max_value=size,widgets=widgets)

def ask_password(url: DownloadURL):
    while True:
        pwd = input("Enter password: ")
        try:
            url.key = DownloadURL.key_from_txt(pwd)
            break
        except ValueError:
            print("Invalid value.", file=sys.stderr)
            continue

def process_error(exc):
    print("Error: %s" % str(exc), file=sys.stderr)
    sys.exit(1)
