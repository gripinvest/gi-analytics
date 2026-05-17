# Ensures `from services... import ...` resolves when pytest runs from backend/.
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
