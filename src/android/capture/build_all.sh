#!/bin/sh

./0_build_fast-screen-capture.sh || exit 1
./1_build_screen-capture.sh || exit 1
./2_build_dlopen.sh || exit 1
