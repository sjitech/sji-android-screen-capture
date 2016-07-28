#!/bin/sh

echo ---------------make standard GCC Tool Chain from Android NDK--------------------
ls -d ./std_toolchain && { echo ./std_toolchain already exist; exit 0; }

printenv NDK_ROOT > /dev/null || { echo please export NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

$NDK_ROOT/build/tools/make_standalone_toolchain.py --install-dir ./std_toolchain --arc arm --verbose

echo ""; echo ok; echo ""
