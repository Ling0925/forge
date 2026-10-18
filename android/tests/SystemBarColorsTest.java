import dev.forge.mobile.SystemBarColors;

public final class SystemBarColorsTest {
    private static int passed;

    public static void main(String[] args) {
        expect(SystemBarColors.parse("#faf9f6") == 0xfffaf9f6);
        expect(SystemBarColors.parse("#171716") == 0xff171716);
        expect(SystemBarColors.parse("#ABCDEF") == 0xffabcdef);
        for (String value : new String[] {"#faf9f6", "#ffffff", "#f2f1ed", "#808080"}) {
            expect(SystemBarColors.useDarkIcons(SystemBarColors.parse(value)));
        }
        for (String value : new String[] {"#171716", "#121211", "#000000", "#222221"}) {
            expect(!SystemBarColors.useDarkIcons(SystemBarColors.parse(value)));
        }
        for (String value : new String[] {null, "", "transparent", "#fff", "#ff112233", "#gggggg", "rgb(0,0,0)", "#123456;bad"}) {
            try {
                SystemBarColors.parse(value);
                throw new AssertionError("Accepted invalid color: " + value);
            } catch (IllegalArgumentException expected) { passed++; }
        }
        System.out.println(passed + " passed, 0 failed");
    }

    private static void expect(boolean valid) {
        if (!valid) throw new AssertionError("Unexpected system bar color/contrast");
        passed++;
    }
}
