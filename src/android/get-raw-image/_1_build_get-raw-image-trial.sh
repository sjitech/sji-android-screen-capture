#!/bin/sh

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

SYS_ROOT=`ls -d $ANDROID_NDK_ROOT/platforms/android-8/arch-arm` || exit 1
TOOL_CHAIN_DIR=`ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-[4-5].*/prebuilt/* | tail -n 1` || exit 1
CC="$TOOL_CHAIN_DIR/bin/arm-linux-androideabi-g++ --sysroot=$SYS_ROOT"

#STL_ROOT=`ls -d $ANDROID_NDK_ROOT/sources/cxx-stl/gnu-libstdc++/[4-5].* | tail -n 1` || exit 1
#CC="$CC -I$STL_ROOT/include -I $STL_ROOT/libs/armeabi/include"

CC="$CC -O3"
CC="$CC -fmax-errors=5"
CC="$CC -fno-rtti -fno-exceptions"

mkdir bin 2>/dev/null
rm -f *.so

for f in lib*.h; do
    f="${f%.*}" #remove extension
    echo ---------------make fake $f.so $v --------------------
    $CC -fPIC -shared -x c++ /dev/null -o $f.so
done

TARGET_DIR=../../../bin/android
t=1

v=220
echo ""
echo ---------------make sc-$v --------------------
$CC -DANDROID_VER=$v               -fPIC -shared get-raw-image.cpp -o $TARGET_DIR/sc-$v || exit 1
echo ---------------make sc-$v test--------------------
$CC -DANDROID_VER=$v -DMAKE_TEST=1 -fPIC -shared get-raw-image.cpp -o bin/sc-$v-test || exit 1
echo ---------------make sc-$v std--------------------
$CC -DANDROID_VER=$v -DMAKE_STD=1  -fPIC -shared get-raw-image.cpp -o bin/sc-$v-std || exit 1

for v in 400 420 500; do
    echo ""
	echo ---------------make sc-$v --------------------
	$CC -DANDROID_VER=$v -DMAKE_TRIAL=$t               -fPIC -shared get-raw-image.cpp libgui.so libbinder.so libutils.so -o $TARGET_DIR/sc-$v -Xlinker -rpath=/system/lib || exit 1

	echo ---------------make sc-$v tester--------------------
	$CC -DANDROID_VER=$v -DMAKE_TRIAL=$t -DMAKE_TEST=1 -fPIC -shared get-raw-image.cpp libgui.so libbinder.so libutils.so -o bin/sc-$v-test -Xlinker -rpath=/system/lib || exit 1

	echo ---------------make sc-$v std--------------------
	$CC -DANDROID_VER=$v -DMAKE_TRIAL=$t -DMAKE_STD=1  -fPIC -shared get-raw-image.cpp libgui.so libbinder.so libutils.so -o bin/sc-$v-std -Xlinker -rpath=/system/lib || exit 1

done

rm -f *.so

echo ""; echo ok; echo ""
