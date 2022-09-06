from setuptools import setup
from pathlib import Path

about = {}
this_dir = Path(__file__).parent.resolve()
with open(this_dir / "secsend_api" / "__version__.py", "r") as f:
    exec(f.read(), about)

setup(name='secsend_api',
      version=about['__version__'],
      description='secsend server API',
      url=about['__url__'],
      author=about['__author__'],
      author_email=about['__author_email__'],
      license=about['__license__'],
      packages=['secsend_api'],
      install_requires=[
          'jsonschema==4.15.*',
          'sanic==21.12.*',
      ],
      extras_require={
          'dev': [
              'sanic-testing==0.8.3',
          ],
      }
)
