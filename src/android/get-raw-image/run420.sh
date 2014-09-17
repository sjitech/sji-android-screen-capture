#!/bin/sh
adb "$@" push bin/fast-screen-capture-420 /data/local/tmp && adb "$@" shell "cd /data/local/tmp && chmod 755 fast-screen-capture-420 && ./fast-screen-capture-420"
