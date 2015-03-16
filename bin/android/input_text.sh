export CLASSPATH=/system/framework/input.jar
##### original script incorrectly pass parameter $* (without quotation), so some letter can not be handled
exec /system/bin/app_process /system/bin com.android.commands.input.Input text "$1"
