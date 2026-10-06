"""Copies of standard library modules (from CPython 3.11, PSF licence) that Decky Loader's bundled Python
leaves out. Decky's PluginLoader is a PyInstaller build, so it only carries the modules Decky itself uses;
html.parser and glob aren't among them (glob was dropped in newer versions). Import the real module first
and fall back to these."""
