from setuptools import setup
from pathlib import Path

about = {}
this_dir = Path(__file__).parent.resolve()
with open(this_dir / "secsend" / "__version__.py", "r") as f:
    exec(f.read(), about)

setup(name='secsend',
      version=about['__version__'],
      description='secsend client library',
      url=about['__url__'],
      author=about['__author__'],
      author_email=about['__author_email__'],
      license=about['__license__'],
      packages=['secsend'],
      scripts=[
          'bin/secupload',
          'bin/secdownload',
          'bin/secadmin'
      ],
      install_requires=[
          'requests>=2.28,<3',
          'python-magic>=0.4,<1',
          'cryptography==37.*',
          'progressbar2==4.*'
      ],
      extras_require={
          'dev': [
              'requests-mock==1.9.*',
          ],
      }
)
