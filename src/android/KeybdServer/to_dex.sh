TOOL_DIR=/Applications/android-sdk-macosx/build-tools/22.0.1

rm -fr ./bin 2> /dev/null
mkdir bin 2> /dev/null
cd ./bin

javac -source 1.5 -target 1.5 -d . -sourcepath ../src ../src/keybdserver/KeybdServer.java 
jar -cvf _keybdserver.jar keybdserver/KeybdServer.class
$TOOL_DIR/dx --dex --output classes.dex _keybdserver.jar
$TOOL_DIR/aapt add keybdserver.jar classes.dex

cp -v keybdserver.jar ../../../../bin/android/
