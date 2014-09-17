#!/bin/sh

./2_build_dlopen.sh || exit 1
./1_build_get-raw-image.sh || exit 1
