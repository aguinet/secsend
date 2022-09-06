from setuptools import setup
from setuptools.command.build_ext import build_ext as _build_ext
from setuptools.command.install import install as _install

import os
import subprocess
import pathlib

THIS_DIR = pathlib.Path(__file__).parent.resolve()

class bundle_npm(_build_ext):
    def run(self):
        prev_dir = os.getcwd()
        os.chdir(THIS_DIR)
        subprocess.check_call(("npm","install"))
        subprocess.check_call(("npm","run","build"))
        os.chdir(prev_dir)

def WrapCommand(cls, cmd_before):
    class Wraped(cls):
        def run(self):
            self.run_command(cmd_before)
            cls.run(self)
    return Wraped

about = {}
with open(THIS_DIR / "secsend_webapp" / "__version__.py", "r") as f:
    exec(f.read(), about)

setup(name='secsend_webapp',
      version=about['__version__'],
      description='secsend webapp static files',
      url=about['__url__'],
      author=about['__author__'],
      author_email=about['__author_email__'],
      license=about['__license__'],
      packages = ["secsend_webapp"],
      include_package_data=True,
      package_data = {"secsend_webapp": ["root/*"]},
      cmdclass={
        'bundle_npm': bundle_npm,
        "install": WrapCommand(_install, 'bundle_npm'),
      }
)
