package keybdserver;

import java.util.Scanner;

public class KeybdServer {

	/**
	 * @param args
	 */
	public static void main(String[] _args) {
		System.out.println("hello");
		Scanner sc = new Scanner(System.in);
		String[] args = new String[] { "type", "value" };
		System.out.println("waiting command");
		for (;;) {
			String s = sc.nextLine();
			if (!s.isEmpty()) {
				if (s.startsWith("k ")) {
					args[0] = "keyevent";
					args[1] = s.substring(2);
					com.android.commands.input.Input.main(args);
				} else if (s.startsWith("K ")) {
					args[0] = "text";
					args[1] = s.substring(2);
					com.android.commands.input.Input.main(args);
				} else {
					System.out.println("invalid command");
				}
			}
		}
	}
}
