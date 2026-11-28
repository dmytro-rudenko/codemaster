public class Billing
{
    public const int Limit = 10;

    public int Create(int first, int second, int third, int fourth, int fifth, int sixth)
    {
        return first;
    }

    public int Walk(int[] items)
    {
        if (items.Length > 0)
        {
            foreach (var item in items)
            {
                while (item > 0)
                {
                    if (item > 1)
                    {
                        break;
                    }
                }
            }
        }
        var cfg = Load(Parse(Read(OpenFile())));
        return cfg;
    }
}
