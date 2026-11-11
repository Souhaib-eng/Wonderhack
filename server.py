#!/usr/bin/env python3
"""
WonderHack — Server Entry Point
Delegates execution to the internal server process in src/server.py.
"""
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.join(_ROOT, 'src')
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.server import main

if __name__ == '__main__':
    main()
