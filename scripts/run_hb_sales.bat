@echo off
cd /d "%~dp0.."
"..\holland-and-barrett-helm-order-feeding-automation\.venv\Scripts\python.exe" scripts\hb_sales.py
